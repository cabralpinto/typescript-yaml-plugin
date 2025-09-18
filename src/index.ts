import fs from 'fs';
import path from 'path';
import type ts from 'typescript/lib/tsserverlibrary';
import YAML from 'yaml';

export = ({ typescript: ts_ }: { typescript: typeof ts }) => ({
  create: (info: ts.server.PluginCreateInfo) => {
    const logger = info.project.projectService.logger;
    const languageServiceHost = {
      getScriptKind: filename => {
        if (!info.languageServiceHost.getScriptKind) return ts_.ScriptKind.Unknown;
        if (/\.ya?ml$/.test(filename)) return ts_.ScriptKind.TS;
        return info.languageServiceHost.getScriptKind(filename);
      },
      getScriptSnapshot: filename => {
        if (!/\.ya?ml$/.test(filename))
          return info.languageServiceHost.getScriptSnapshot(filename);
        const content = fs.readFileSync(filename, 'utf8');
        let object;
        try {
          object = YAML.parse(content);
        } catch (error) {
          logger.info(`[typescript-plugin-yaml] YAML.parse error:\n${error}`);
        }
        const text = `export default ${JSON.stringify(object)};`;
        return ts_.ScriptSnapshot.fromString(text);
      },
      resolveModuleNameLiterals: (moduleLiterals, containingFile, ...rest) =>
        info.languageServiceHost.resolveModuleNameLiterals!(
          moduleLiterals,
          containingFile,
          ...rest
        ).map((resolvedModule, index) => {
          const moduleName = moduleLiterals[index].text;
          if (!/\.ya?ml$/.test(moduleName)) return resolvedModule;

          if (resolvedModule.resolvedModule?.resolvedFileName) {
            return {
              ...resolvedModule,
              resolvedModule: {
                ...resolvedModule.resolvedModule,
                extension: ts_.Extension.Ts,
                isExternalLibraryImport: false,
              }
            };
          }

          const resolvedPath = resolvePathCustom(moduleName, containingFile);
          return {
            ...resolvedModule,
            resolvedModule: {
              extension: ts_.Extension.Ts,
              isExternalLibraryImport: false,
              resolvedFileName: resolvedPath
            }
          };
        })
    } as Partial<ts.LanguageServiceHost>;
    const resolvePathCustom = (moduleName: string, containingFile: string): string => {
      if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
        return path.resolve(path.dirname(containingFile), moduleName);
      }

      const compilerOptions = info.languageServiceHost.getCompilationSettings() || {};
      if (compilerOptions.paths && compilerOptions.baseUrl) {
        for (const [pattern, substitutions] of Object.entries(compilerOptions.paths)) {
          const regexPattern = pattern.replace(/\*/g, '(.*)');
          const regex = new RegExp('^' + regexPattern + '$');
          const match = moduleName.match(regex);

          if (match) {
            for (const substitution of substitutions) {
              let resolvedPattern = substitution;
              for (let i = 1; i < match.length; i++) {
                resolvedPattern = resolvedPattern.replace('*', match[i]);
              }

              const resolvedPath = path.resolve(compilerOptions.baseUrl, resolvedPattern);
              if (fs.existsSync(resolvedPath)) {
                return resolvedPath;
              }
            }
          }
        }
      }

      return path.resolve(path.dirname(containingFile), moduleName);
    };
    const languageServiceHostProxy = new Proxy(info.languageServiceHost, {
      get: (target, key: keyof ts.LanguageServiceHost) =>
        languageServiceHost[key] ? languageServiceHost[key] : target[key]
    });
    return ts_.createLanguageService(languageServiceHostProxy);
  }
});

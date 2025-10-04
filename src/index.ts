import fs from 'fs';
import path from 'path';
import type ts from 'typescript/lib/tsserverlibrary';
import YAML from 'yaml';

export = ({ typescript: ts_ }: { typescript: typeof ts }) => ({
  create: (info: ts.server.PluginCreateInfo) => {
    const logger = info.project.projectService.logger;
    const languageServiceHost = info.languageServiceHost;

    const getScriptKind = languageServiceHost.getScriptKind?.bind(languageServiceHost);
    languageServiceHost.getScriptKind = filename => {
      if (!getScriptKind) return ts_.ScriptKind.Unknown;
      if (/\.ya?ml$/.test(filename)) return ts_.ScriptKind.TS;
      return getScriptKind(filename);
    };

    const getScriptSnapshot =
      languageServiceHost.getScriptSnapshot.bind(languageServiceHost);
    languageServiceHost.getScriptSnapshot = filename => {
      if (!/\.ya?ml$/.test(filename)) return getScriptSnapshot(filename);
      const content = fs.readFileSync(filename, 'utf8');
      let object;
      try {
        object = YAML.parse(content);
      } catch (error) {
        logger.info(`[typescript-plugin-yaml] YAML.parse error:\n${error}`);
      }
      const text = `export default ${JSON.stringify(object)};`;
      return ts_.ScriptSnapshot.fromString(text);
    };

    const resolveModuleNameLiterals =
      languageServiceHost.resolveModuleNameLiterals!.bind(languageServiceHost);
    languageServiceHost.resolveModuleNameLiterals = (
      moduleLiterals,
      containingFile,
      ...rest
    ) =>
      resolveModuleNameLiterals(moduleLiterals, containingFile, ...rest).map(
        (resolvedModule, index) => {
          const moduleName = moduleLiterals[index].text;
          if (!/\.ya?ml$/.test(moduleName)) return resolvedModule;
          return {
            ...resolvedModule,
            resolvedModule: {
              extension: ts_.Extension.Ts,
              isExternalLibraryImport: false,
              resolvedFileName: path.resolve(path.dirname(containingFile), moduleName)
            }
          };
        }
      );

    return info.languageService;
  }
});

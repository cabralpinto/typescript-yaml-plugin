import fs from 'fs';
import path from 'path';
import type ts from 'typescript/lib/tsserverlibrary';
import YAML from 'yaml';

export = ({ typescript: ts_ }: { typescript: typeof ts }) => ({
  create: (info: ts.server.PluginCreateInfo) => {
    const logger = info.project.projectService.logger;
    const { languageServiceHost, languageService } = info;

    const getScriptKind = languageServiceHost.getScriptKind?.bind(languageServiceHost);
    languageServiceHost.getScriptKind = fileName => {
      if (!getScriptKind) return ts_.ScriptKind.Unknown;
      if (/\.ya?ml$/.test(fileName)) return ts_.ScriptKind.TS;
      return getScriptKind(fileName);
    };
    let resolvedFileName: string;
    const fileExists = languageServiceHost.fileExists.bind(languageServiceHost);
    languageServiceHost.fileExists = path => {
      if (/(?:\.ya?ml|\*)\.ts$/.test(path)) resolvedFileName = path.slice(0, -3);
      return fileExists(path);
    };
    const getScriptSnapshot =
      languageServiceHost.getScriptSnapshot.bind(languageServiceHost);
    languageServiceHost.getScriptSnapshot = fileName => {
      if (!/\.ya?ml$/.test(fileName)) return getScriptSnapshot(fileName);
      if (!fileExists(fileName)) return;
      const content = fs.readFileSync(fileName, 'utf8');
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
              resolvedFileName
            }
          };
        }
      );

    const languageServiceOverride = {
      getCompletionsAtPosition(fileName, position, options, formattingSettings) {
        const completions = languageService.getCompletionsAtPosition(
          fileName,
          position,
          options,
          formattingSettings
        );
        if (!completions) return completions;
        const program = info.languageService.getProgram();
        if (!program) return completions;
        const moduleName = program
          .getSourceFile(fileName)
          ?.getFullText()
          .slice(0, position)
          .match(/(?<=(?:import(?:\(|\s?)|require\(|from\s?)["']).+?$/s)?.[0];
        if (!moduleName) return completions;
        ts_.resolveModuleName(
          moduleName,
          fileName,
          program.getCompilerOptions(),
          languageServiceHost
        );
        fs.globSync(`${resolvedFileName}.{yaml,yml}`)
          .map(fileName => path.basename(fileName))
          .forEach(baseFileName =>
            completions.entries.push({
              name: baseFileName,
              kind: ts_.ScriptElementKind.scriptElement,
              kindModifiers: '.yaml',
              sortText: '11'
            })
          );
        return completions;
      }
    } as Partial<ts.LanguageService>;
    const languageServiceProxy = new Proxy(languageService, {
      get: (target, key: keyof ts.LanguageService) =>
        languageServiceOverride[key] ?? target[key]
    });
    return languageServiceProxy;
  }
});

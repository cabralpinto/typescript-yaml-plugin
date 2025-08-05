import type ts from "typescript/lib/tsserverlibrary";

export = ({ typescript: ts_ }: { typescript: typeof ts }) => ({
  create: (info: ts.server.PluginCreateInfo) => {
    const languageServiceHost = {} as Partial<ts.LanguageServiceHost>;
    const languageServiceHostProxy = new Proxy(info.languageServiceHost, {
      get: (target, key: keyof ts.LanguageServiceHost) =>
        languageServiceHost[key] ? languageServiceHost[key] : target[key],
    });
    return ts_.createLanguageService(languageServiceHostProxy);
  },
});

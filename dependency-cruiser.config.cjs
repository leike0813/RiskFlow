module.exports = {
  forbidden: [
    {
      name: "no-shared-package-to-app",
      comment: "共享包不得依赖应用",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    ...[
      ["api", "web|worker"],
      ["web", "api|worker"],
      ["worker", "api|web"],
    ].map(([from, to]) => ({
      name: `no-${from}-to-app`,
      comment: "应用之间不得互相依赖",
      severity: "error",
      from: { path: `^apps/${from}/` },
      to: { path: `^apps/(?:${to})/` },
    })),
    {
      name: "no-contracts-reverse-dependency",
      comment: "contracts 不得反向依赖其它共享包",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { path: "^packages/(?:core|adapters)/" },
    },
    {
      name: "no-core-to-adapters",
      comment: "core 不得依赖 adapters",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^packages/adapters/" },
    },
    ...["contracts", "core", "adapters"].map((target) => ({
      name: `no-${target}-deep-import`,
      comment: "跨包只能使用公开入口，不得导入包内 src 路径",
      severity: "error",
      from: { path: "^(?:apps|packages)/", pathNot: `^packages/${target}/` },
      to: { path: `^packages/${target}/src/` },
    })),
    {
      name: "no-production-to-demo",
      comment: "生产代码不得依赖汇报 Demo",
      severity: "error",
      from: { path: "^(?:apps|packages)/" },
      to: { path: "^demo/" },
    },
    {
      name: "no-circular",
      comment: "生产依赖图不得形成循环",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "(?:(?:^|/)node_modules(?:/|$)|(?:^|/)demo(?:/|$))",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    exclude: { path: "(?:^|/)dist(?:/|$)" },
    moduleSystems: ["es6", "cjs", "tsd"],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      conditionNames: ["import", "require", "node", "default", "types"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    },
  },
};

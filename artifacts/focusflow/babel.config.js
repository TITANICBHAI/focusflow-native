module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@/data": "./src/data",
            "@/context": "./src/context",
            "@/services": "./src/services",
            "@/hooks": "./src/hooks",
            "@/native-modules": "./src/native-modules",
            "@/navigation": "./src/navigation",
            "@/styles": "./src/styles",
            "@/tasks": "./src/tasks",
            "@/components": "./src/components",
          },
        },
      ],
    ],
  };
};

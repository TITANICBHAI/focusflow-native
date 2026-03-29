const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

process.env.EXPO_ROUTER_APP_ROOT = "app";

const config = getDefaultConfig(__dirname);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "./_ctx" &&
    context.originModulePath.includes("/expo-router/")
  ) {
    const overrideFile = path.resolve(
      __dirname,
      `_ctx-override.${platform}.js`
    );
    return { filePath: overrideFile, type: "sourceFile" };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

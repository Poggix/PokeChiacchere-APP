const { withAppDelegate } = require('@expo/config-plugins');

module.exports = function withPokeLocationAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('import PokeLocation')) {
      const importAnchor = contents.match(/^import .*$/m);
      if (!importAnchor) {
        throw new Error('PokeLocation plugin: unable to find Swift imports in AppDelegate.');
      }
      contents = contents.replace(importAnchor[0], importAnchor[0] + '\nimport PokeLocation');
    }

    const restoreCall = 'PokeLocationManager.shared.restoreIfEnabled()';
    if (!contents.includes(restoreCall)) {
      const launchCall = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
      if (!contents.includes(launchCall)) {
        throw new Error('PokeLocation plugin: unsupported AppDelegate template; cannot install native location restoration.');
      }
      contents = contents.replace(
        launchCall,
        restoreCall + '\n    ' + launchCall
      );
    }

    config.modResults.contents = contents;
    return config;
  });
};

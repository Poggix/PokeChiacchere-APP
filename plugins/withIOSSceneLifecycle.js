const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const MARKER = '// PokeChiacchere UIScene lifecycle';

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(MARKER)) return config;

    const windowSetup = /\n#if os\(iOS\) \|\| os\(tvOS\)\n    window = UIWindow\(frame: UIScreen\.main\.bounds\)\n    factory\.startReactNative\(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions\)\n#endif/;
    if (!windowSetup.test(contents)) {
      throw new Error('UIScene plugin: unexpected Expo AppDelegate template while moving React Native startup to SceneDelegate.');
    }
    contents = contents.replace(windowSetup, '\n    self.launchOptions = launchOptions');

    const windowProperty = '  var window: UIWindow?\n';
    if (!contents.includes(windowProperty)) {
      throw new Error('UIScene plugin: AppDelegate window property not found.');
    }
    contents = contents.replace(windowProperty, windowProperty + '  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n');

    contents += `\n${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: appDelegate.launchOptions)

    for context in connectionOptions.urlContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      _ = appDelegate.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in contexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;
    config.modResults.contents = contents;
    return config;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    };
    return config;
  });
}

module.exports = (config) => withSceneManifest(withSceneAppDelegate(config));

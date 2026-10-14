require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name           = 'PokeLocation'
  s.version        = package['version']
  s.summary        = 'Native iOS background location tracking for PokeChiacchere'
  s.description    = 'Core Location significant-change and standard location updates.'
  s.license        = 'MIT'
  s.author         = 'PokeChiacchere'
  s.homepage       = 'https://github.com/Poggix/PokeChiacchere-APP'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/Poggix/PokeChiacchere-APP.git', :tag => s.version.to_s }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end

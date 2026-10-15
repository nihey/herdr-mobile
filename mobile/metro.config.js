const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Keep local APK builds usable alongside running coding agents.
config.maxWorkers = 2;
module.exports = config;

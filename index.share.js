import { AppRegistry } from 'react-native';
import ShareExtension from './src/ShareExtension';

// Required by expo-share-extension: the first argument to registerComponent
// must be exactly "shareExtension" — this is the bundle the native Share
// Extension target loads, separate from the main app's expo-router entry.
AppRegistry.registerComponent('shareExtension', () => ShareExtension);

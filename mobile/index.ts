// Expo Router's entry, plus the home screen widget's background task.
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/update';

registerWidgetTaskHandler(widgetTaskHandler);

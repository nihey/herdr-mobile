# Herd Remote privacy policy

Effective October 20, 2026.

Herd Remote is an unofficial Android companion for [Herdr](https://github.com/herdrdev/herdr). It is not affiliated with the Herdr project. Its source is published at <https://github.com/nihey/herdr-mobile>.

## Summary

The developer runs no server and receives no data from the app. The app has no accounts, ads, analytics or crash reporting. It talks only to the bridges that you pair: small programs that you run on your own computers.

## Data stored on your phone

- Each paired bridge's address, name and pairing token. These are kept in Android's encrypted storage (Expo SecureStore, backed by the Android Keystore).
- Your dictation language choice (English or Portuguese).

Removing a machine in the app deletes its saved entry. Uninstalling the app, or clearing its storage, deletes everything.

## Data sent over the network

The app sends requests only to the bridge addresses that you enter or pick. The recommended setup is your private Tailscale network. These requests carry the pairing token, the prompts, keys and text that you send, and the agent status and terminal output that your computer returns. When you open device discovery, they also return the names and private addresses of the devices on your tailnet. This data moves between your phone and your own computer. It is not sent to the developer or to any other party.

## Microphone

The app records audio only while dictation is on. Dictation starts when you tap the microphone and stops when you tap stop. The app requires Android's on-device speech recognition, so speech is converted to text on the phone. The app does not save audio. The transcript only fills the text box. It is sent, to your own bridge, only when you tap Send. Android or Google's speech service may download an offline language model the first time a language is used. That service is provided by your phone's system software and is subject to its own terms.

## Permissions

- **Internet:** connects to your bridges.
- **Microphone:** on-device dictation, only while you are dictating.

## Children

The app is a developer tool. It is not directed at children.

## Changes and contact

Changes to this policy are published in this file, with a new effective date. Send questions through [GitHub issues](https://github.com/nihey/herdr-mobile/issues).

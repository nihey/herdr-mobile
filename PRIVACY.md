# Herd Remote privacy policy

Effective November 3, 2026.

Herd Remote is an unofficial Android companion for [Herdr](https://github.com/herdrdev/herdr). It is not affiliated with the Herdr project. Its source is published at <https://github.com/nihey/herdr-mobile>.

## Summary

The developer runs no server and receives no data from the app. If you use the optional Hermes chat, your computer sends your Hermes messages and the agent output it reads to Hermes's AI model provider. The app has no accounts, ads, analytics or crash reporting. It talks only to the bridges that you pair: small programs that you run on your own computers.

## Data stored on your phone

- Each paired bridge's address, name and pairing token. These are kept in Android's encrypted storage (Expo SecureStore, backed by the Android Keystore).
- Your dictation language choice (English or Portuguese).

Removing a machine in the app deletes its saved entry. Uninstalling the app, or clearing its storage, deletes everything.

## Data sent over the network

The app sends requests only to the bridge addresses that you enter or pick. The recommended setup is your private Tailscale network. These requests carry the pairing token, the prompts, keys and text that you send, the sessions and terminals that you start (project or home folder, agent kind and name), the commands that you run in terminals, and the agent status and terminal output that your computer returns. When you open device discovery, they also return the names and private addresses of the devices on your tailnet. This data moves between your phone and your own computer. It is not sent to the developer or to any other party, except what you choose to send to Hermes's model provider (see Hermes).

## Hermes

The app includes an optional chat with a Hermes agent that runs on your computer, started by your bridge. Hermes starts when you open the Hermes chat. When you use it, your messages to Hermes, and what Hermes reads from your agents to answer (their names, task titles, project names and folders, status and recent terminal output, which can include code, logs or anything an agent printed), are sent from your computer to the AI model provider that Hermes is configured to use there. By default that is OpenAI, through your own Codex sign-in. When Hermes starts with a model it has not used before, it first sends one short test request with no agent data. The conversation is kept on your computer in Hermes's own session store. Nothing is sent to a model provider unless you open the Hermes chat. Reporting a reply opens a draft email in your email app; nothing is sent unless you send it.

## Microphone

The app records audio only while dictation is on. Dictation starts when you tap the microphone and stops when you tap stop. The app requires Android's on-device speech recognition, so speech is converted to text on the phone. The app does not save audio. The transcript only fills the text box. It is sent, to your own bridge, only when you tap Send (or start session / open terminal, for a new session's first task or a terminal's first command). Android or Google's speech service may download an offline language model the first time a language is used. That service is provided by your phone's system software and is subject to its own terms.

## Permissions

- **Internet:** connects to your bridges.
- **Microphone:** on-device dictation, only while you are dictating.

## Children

The app is a developer tool. It is not directed at children.

## Changes and contact

Changes to this policy are published in this file, with a new effective date. Send questions through [GitHub issues](https://github.com/nihey/herdr-mobile/issues).

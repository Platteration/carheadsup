export interface PhoneLinkStatus {
  connected: boolean;
  deviceName: string | null;
  /** The phone's identity (`hello.deviceId`); null when unknown. */
  deviceId: string | null;
  appVersion: string | null;
  /** Epoch ms of the last connect/disconnect. */
  since: number;
}

export interface MediaInfo {
  playing: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Source app label, e.g. "Spotify". */
  app: string | null;
  /** Stable identity for change detection (title+artist+album if the app gives nothing better). */
  trackKey: string;
  updatedAt: number;
}

export type CallState = 'ringing' | 'dialing' | 'active' | 'held' | 'ended';

export interface CallInfo {
  id: string;
  state: CallState;
  /** Contact name resolved on the phone, if any. */
  callerName: string | null;
  /** Phone number as the phone formats it, if known. */
  number: string | null;
  startedAt: number;
  updatedAt: number;
}

/**
 * An incoming message notification. By design this carries the sender only —
 * message content is never sent to the HUD; the phone reads it aloud instead.
 */
export interface MessageInfo {
  id: string;
  sender: string;
  /** Messaging app label, e.g. "WhatsApp", "Messages". */
  app: string | null;
  receivedAt: number;
  /** True when the phone is reading the message aloud. */
  readingAloud: boolean;
}

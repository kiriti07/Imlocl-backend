import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

const expo = new Expo();

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export async function sendPushNotification(
  pushToken: string | null | undefined,
  payload: NotificationPayload
): Promise<void> {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error('Push notification error:', error);
  }
}

export async function sendBulkPushNotifications(
  tokens: string[],
  payload: NotificationPayload
): Promise<void> {
  const validTokens = tokens.filter(t => Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return;

  const messages: ExpoPushMessage[] = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error('Bulk push notification error:', error);
  }
}
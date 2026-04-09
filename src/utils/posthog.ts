import PostHog from 'posthog-react-native';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let posthog: PostHog | null = null;

const APP_NAME = 'form-coach';

export async function initAnalytics(): Promise<void> {
  if (!POSTHOG_API_KEY) return;
  try {
    posthog = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushInterval: 30000,
      flushAt: 20,
    });
    posthog.register({ app_name: APP_NAME });
  } catch {
    posthog = null;
  }
}

export function trackEvent(event: string, properties?: Record<string, string | number | boolean>): void {
  try {
    posthog?.capture(event, properties);
  } catch {}
}

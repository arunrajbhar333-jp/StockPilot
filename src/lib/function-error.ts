/**
 * Turns a `supabase.functions.invoke` failure into the message the Edge
 * Function actually returned, falling back to a deploy hint when the request
 * never reached it.
 */
export async function readFunctionError(
  error: unknown,
  functionName: string,
): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error) return body.error;
      } catch {
        /* fall through to the generic message */
      }
    }
  }
  if (error instanceof Error && error.message) {
    if (error.message.toLowerCase().includes("failed to send a request")) {
      return `The ${functionName} function is not deployed. Deploy it with \`supabase functions deploy ${functionName}\`.`;
    }
    return error.message;
  }
  return `The ${functionName} request failed. Check the Edge Function logs and try again.`;
}

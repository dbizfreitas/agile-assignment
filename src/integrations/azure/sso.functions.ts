import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const completeMicrosoftLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: z.string().min(1).max(4000), redirectUri: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const { exchangeMicrosoftCode } = await import("./sso.server");
    return exchangeMicrosoftCode(data.code, data.redirectUri);
  });

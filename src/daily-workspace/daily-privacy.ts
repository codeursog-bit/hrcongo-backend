/** Les contenus personnels ne doivent pas réapparaître dans les journaux consultables par les RH. */
export const isDailyPrivateRoute = (path: string) =>
  /^\/(?:api\/)?(?:support|admin\/support|contact|assistant|tasks|announcements|day-events|anniversaries|appearance)(?:\/|$)/.test(
    path,
  ) ||
  /^\/(?:api\/)?(?:users\/me|companies\/[^/]+)\/appearance(?:\?|$)/.test(path);

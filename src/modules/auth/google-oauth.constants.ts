export const googleOAuthStateKey = (state: string): string =>
  `oauth:google:state:${state}`;

export const googleOAuthCodeKey = (tokenHash: string): string =>
  `oauth:google:code:${tokenHash}`;

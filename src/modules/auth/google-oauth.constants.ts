export const googleOAuthStateKey = (state: string): string =>
  `oauth:google:state:${state}`;

export const googleOAuthCodeKey = (tokenHash: string): string =>
  `oauth:google:code:${tokenHash}`;

export const googleReauthStateKey = (state: string): string =>
  `oauth:google:reauth:state:${state}`;

export const googleReauthCodeKey = (tokenHash: string): string =>
  `oauth:google:reauth:code:${tokenHash}`;

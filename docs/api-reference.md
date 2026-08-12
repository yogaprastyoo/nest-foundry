# API Reference

This document provides complete specification for all 20 REST API route endpoints provided by `loopwork-backend`.

Base URL: `/api/v1` (`src/main.ts:20`)  
Global Response Envelope Format (`src/common/interceptors/transform.interceptor.ts:16`):
- **Success:** `{ "success": true, "message": "...", "data": { ... } }`
- **Error:** `{ "success": false, "message": "...", "errors": null }`

---

## 1. Auth Module (`src/modules/auth/auth.controller.ts:62`)

### 1.1 Start Google Sign-In
- **Method & Path:** `GET /api/v1/auth/google` (`src/modules/auth/auth.controller.ts:73`)
- **Authentication:** Public (`@Public()`) + `GoogleOAuthGuard` (`src/modules/auth/guards/google-oauth.guard.ts:6`)
- **Response:** Issues 302 Redirect to Google OAuth Consent Screen.

---

### 1.2 Google Sign-In Callback
- **Method & Path:** `GET /api/v1/auth/google/callback` (`src/modules/auth/auth.controller.ts:79`)
- **Authentication:** Public (`@Public()`) + `GoogleOAuthGuard`
- **Response:** Bypasses JSON envelope, issues 302 Redirect to `GOOGLE_FRONTEND_CALLBACK_URL?code={exchangeCode}`.

---

### 1.3 Exchange Google One-Time Code
- **Method & Path:** `POST /api/v1/auth/google/exchange` (`src/modules/auth/auth.controller.ts:105`)
- **Authentication:** Public (`@Public()`)
- **Rate Limit:** 5 requests / 60 seconds
- **Cookie Set:** `SetRefreshCookieInterceptor` (`src/modules/auth/interceptors/set-refresh-cookie.interceptor.ts:15`)
- **Request DTO:** `GoogleExchangeDto` (`src/modules/auth/dto/google-exchange.dto.ts:4`) (`code: string`)
- **Response Body:** Standard login success payload containing `accessToken` and user profile.

---

### 1.4 Register
- **Method & Path:** `POST /api/v1/auth/register` (`src/modules/auth/auth.controller.ts:126`)
- **Authentication:** Public (`@Public()`)
- **Rate Limit:** 5 requests / 60 seconds
- **Request DTO:** `RegisterDto` (`src/modules/auth/dto/register.dto.ts:6`)
  | Field | Type | Rules |
  | :--- | :--- | :--- |
  | `email` | `string` | `@IsEmail()`, `@IsNotEmpty()`, `@NormalizeEmail()` |
  | `password` | `string` | `@IsString()`, `@MinLength(8)`, `@MaxLength(100)` |
  | `name` | `string` | `@IsString()`, `@IsNotEmpty()`, `@MinLength(2)`, `@MaxLength(100)` |

- **Response Body:**
  ```json
  {
    "success": true,
    "message": "Registration successful.",
    "data": {
      "id": "cm701a2b3c4d5e6f7g8h9i0j",
      "email": "user@example.test",
      "name": "John Doe",
      "role": "USER",
      "emailVerified": false,
      "createdAt": "2026-08-13T00:00:00.000Z"
    }
  }
  ```
- **Error Statuses:** `400 Bad Request` (Validation failure), `409 Conflict` (Email registered).

---

### 1.5 Verify Email
- **Method & Path:** `POST /api/v1/auth/verify-email` (`src/modules/auth/auth.controller.ts:143`)
- **Authentication:** Public (`@Public()`)
- **Request DTO:** `VerifyEmailDto` (`src/modules/auth/dto/verify-email.dto.ts:4`) (`token: string`)
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "Email verified successfully.",
    "data": null
  }
  ```
- **Error Statuses:** `400 Bad Request` (Invalid or expired token).

---

### 1.6 Resend Verification Email
- **Method & Path:** `POST /api/v1/auth/resend-verification` (`src/modules/auth/auth.controller.ts:156`)
- **Authentication:** Public (`@Public()`)
- **Request DTO:** `ResendVerificationDto` (`src/modules/auth/dto/resend-verification.dto.ts:5`) (`email: string`)
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "If the email is registered, a verification link has been sent.",
    "data": null
  }
  ```
- **Error Statuses:** `400 Bad Request` (Validation error). Uniform 200 return is preserved for non-existent or verified emails to prevent enumeration.

---

### 1.7 Login
- **Method & Path:** `POST /api/v1/auth/login` (`src/modules/auth/auth.controller.ts:173`)
- **Authentication:** `LocalAuthGuard` (`src/modules/auth/guards/local-auth.guard.ts:8`)
- **Cookie Set:** `SetRefreshCookieInterceptor` (`src/modules/auth/interceptors/set-refresh-cookie.interceptor.ts:15`)
- **Request DTO:** `LoginDto` (`src/modules/auth/dto/login.dto.ts:6`) (`email: string`, `password: string`)
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "Login successful.",
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "cm701a2b3c4d5e6f7g8h9i0j",
        "email": "user@example.test",
        "name": "John Doe",
        "role": "USER"
      }
    }
  }
  ```
- **Error Statuses:** `401 Unauthorized` (Invalid credentials), `403 Forbidden` (Unverified email), `429 Too Many Requests` (Lockout/Rate limit).

---

### 1.8 Refresh Access Token
- **Method & Path:** `POST /api/v1/auth/refresh` (`src/modules/auth/auth.controller.ts:190`)
- **Authentication:** Public (`@Public()`) + Token extracted via `@RefreshToken()` decorator (`src/modules/auth/decorators/refresh-token.decorator.ts:5`)
- **Cookie Set:** `SetRefreshCookieInterceptor`
- **Request Body (Optional):** `{ "refresh_token": "string" }`
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "Token refreshed successfully.",
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Error Statuses:** `401 Unauthorized` (Invalid, expired, or reused refresh token).

---

### 1.9 Logout
- **Method & Path:** `POST /api/v1/auth/logout` (`src/modules/auth/auth.controller.ts:214`)
- **Authentication:** Public (`@Public()`) + Token extracted via `@RefreshToken()`
- **Cookie Clear:** `ClearRefreshCookieInterceptor` (`src/modules/auth/interceptors/clear-refresh-cookie.interceptor.ts:10`)
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "Logout successful.",
    "data": null
  }
  ```

---

### 1.10 Request Password Reset
- **Method & Path:** `POST /api/v1/auth/forgot-password` (`src/modules/auth/auth.controller.ts:237`)
- **Authentication:** Public (`@Public()`)
- **Request DTO:** `ForgotPasswordDto` (`src/modules/auth/dto/forgot-password.dto.ts:5`) (`email: string`)
- **Response Body:** `{ "success": true, "message": "If the email is registered, a password reset link has been sent.", "data": null }`

---

### 1.11 Execute Password Reset
- **Method & Path:** `POST /api/v1/auth/reset-password` (`src/modules/auth/auth.controller.ts:254`)
- **Authentication:** Public (`@Public()`)
- **Request DTO:** `ResetPasswordDto` (`src/modules/auth/dto/reset-password.dto.ts:5`) (`token: string`, `password: string`)
- **Response Body:** `{ "success": true, "message": "Password reset successfully. Please sign in again.", "data": null }`

---

### 1.12 Change Password (Authenticated)
- **Method & Path:** `POST /api/v1/auth/change-password` (`src/modules/auth/auth.controller.ts:266`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Cookie Clear:** `ClearRefreshCookieInterceptor`
- **Request DTO:** `ChangePasswordDto` (`src/modules/auth/dto/change-password.dto.ts:5`) (`currentPassword: string`, `newPassword: string`)
- **Response Body:** `{ "success": true, "message": "Password changed successfully. Please sign in again.", "data": null }`

---

### 1.13 Start Google Reauthentication
- **Method & Path:** `GET /api/v1/auth/google/reauth` (`src/modules/auth/auth.controller.ts:282`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`) + `GoogleReauthGuard` (`src/modules/auth/guards/google-reauth.guard.ts:6`)
- **Query DTO:** `GoogleReauthQueryDto` (`src/modules/auth/dto/google-reauth-query.dto.ts:4`) (`purpose: string`)
- **Response:** Issues 302 Redirect to Google reauth consent prompt.

---

### 1.14 Complete Google Reauthentication Callback
- **Method & Path:** `GET /api/v1/auth/google/reauth/callback` (`src/modules/auth/auth.controller.ts:292`)
- **Authentication:** Public (`@Public()`) + `GoogleReauthGuard`
- **Response:** Bypasses envelope, issues 302 Redirect to `GOOGLE_FRONTEND_CALLBACK_URL?code={reauthCode}&purpose={purpose}`.

---

### 1.15 Set Password (Google-Only Accounts)
- **Method & Path:** `POST /api/v1/auth/set-password` (`src/modules/auth/auth.controller.ts:330`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Cookie Clear:** `ClearRefreshCookieInterceptor`
- **Request DTO:** `SetPasswordDto` (`src/modules/auth/dto/set-password.dto.ts:5`) (`password: string`, `reauthCode?: string`)
- **Response Body:** `{ "success": true, "message": "Password set successfully. Please sign in again.", "data": null }`

---

### 1.16 Unlink Google Identity
- **Method & Path:** `POST /api/v1/auth/unlink-google` (`src/modules/auth/auth.controller.ts:349`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Cookie Clear:** `ClearRefreshCookieInterceptor`
- **Request DTO:** `UnlinkGoogleDto` (`src/modules/auth/dto/unlink-google.dto.ts:5`) (`password?: string`, `reauthCode?: string`)
- **Response Body:** `{ "success": true, "message": "Google account unlinked successfully. Please sign in again.", "data": null }`

---

## 2. Users Module (`src/modules/users/users.controller.ts:21`)

### 2.1 Get Current User Profile
- **Method & Path:** `GET /api/v1/users/me` (`src/modules/users/users.controller.ts:25`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Response Body:**
  ```json
  {
    "success": true,
    "message": "User profile retrieved successfully.",
    "data": {
      "id": "cm701a2b3c4d5e6f7g8h9i0j",
      "email": "user@example.test",
      "name": "John Doe",
      "role": "USER",
      "emailVerified": true,
      "avatarUrl": "https://ui-avatars.com/api/?name=John+Doe",
      "createdAt": "2026-08-13T00:00:00.000Z",
      "updatedAt": "2026-08-13T00:00:00.000Z"
    }
  }
  ```

---

### 2.2 Update Current User Profile
- **Method & Path:** `PATCH /api/v1/users/me` (`src/modules/users/users.controller.ts:37`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Request DTO:** `UpdateUserDto` (`src/modules/users/dto/update-user.dto.ts:4`) (`name?: string`)
- **Response Body:** Standard `UserResponseDto` envelope.

---

### 2.3 Delete Current User Account
- **Method & Path:** `DELETE /api/v1/users/me` (`src/modules/users/users.controller.ts:49`)
- **Authentication:** JWT Access Token (`JwtAuthGuard`)
- **Cookie Clear:** `ClearRefreshCookieInterceptor`
- **Response Body:** `{ "success": true, "message": "Account deleted successfully.", "data": null }`

---

## 3. Health Module (`src/modules/health/health.controller.ts:14`)

### 3.1 System Health Check
- **Method & Path:** `GET /api/v1/health` (`src/modules/health/health.controller.ts:23`)
- **Authentication:** Public (`@Public()`)
- **Response Body:** Includes database and redis connection status (`src/modules/health/health.controller.ts:27`).

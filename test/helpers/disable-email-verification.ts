// Must be imported BEFORE any module that triggers ConfigModule.forRoot(),
// which reads env at import time. This suite covers the "verification off"
// paths, so pin the toggle instead of inheriting whatever the developer has
// in their local .env.
process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false';

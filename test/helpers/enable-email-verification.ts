// Must be imported BEFORE any module that triggers ConfigModule.forRoot(),
// which reads env at import time. Enables the verification toggle for the
// email-verification e2e suite.
process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'true';

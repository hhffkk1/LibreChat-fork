/* fork 版 localStrategy.js —— 用户名【或】邮箱都能登(原版只按 email 查)。
 * 覆盖 LibreChat 的 api/strategies/localStrategy.js。改动只有 passportLogin 里"查用户"那几行 + 顶部注释。
 * 配合:validators.js 的 loginSchema 把 email 从 z.string().email() 放宽为 z.string().min(1)(见同目录说明)。
 * 前端:LoginForm.tsx 让字段标签/校验支持用户名(见 README);或设 env ALLOW_USERNAME_LOGIN=true 由前端读。 */
const bcrypt = require('bcryptjs');
const { logger } = require('@librechat/data-schemas');
const { errorsToString } = require('librechat-data-provider');
const { Strategy: PassportLocalStrategy } = require('passport-local');
const { isEnabled, checkEmailConfig, comparePassword } = require('@librechat/api');
const { findUser, updateUser } = require('~/models');
const { loginSchema } = require('./validators');

const verificationEnabledTimestamp = 1717788018;

async function validateLoginRequest(req) {
  const { error } = loginSchema.safeParse(req.body);
  return error ? errorsToString(error.errors) : null;
}

async function passportLogin(req, email, password, done) {
  try {
    const validationError = await validateLoginRequest(req);
    if (validationError) {
      logError('Passport Local Strategy - Validation Error', { email: req.body?.email });
      logger.error(`[Login] [Login failed] [Account: ${email}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: validationError });
    }

    // ★ 用户名或邮箱:有 @ 按 email 查,否则按 username 查;都试一遍(兜底)。
    const raw = String(email || '').trim();
    const byEmail = /@/.test(raw);
    let user = await findUser(byEmail ? { email: raw } : { username: raw }, '+password');
    if (!user) {
      user = await findUser(byEmail ? { username: raw } : { email: raw }, '+password');
    }
    if (!user) {
      logError('Passport Local Strategy - User Not Found', { account: raw });
      logger.error(`[Login] [Login failed] [Account: ${raw}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Account does not exist.' });
    }

    if (!user.password) {
      logError('Passport Local Strategy - User has no password', { account: raw });
      logger.error(`[Login] [Login failed] [Account: ${raw}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Account does not exist.' });
    }

    const isMatch = await comparePassword(user, password, { compare: bcrypt.compare });
    if (!isMatch) {
      logError('Passport Local Strategy - Password does not match', { isMatch });
      logger.error(`[Login] [Login failed] [Account: ${raw}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Incorrect password.' });
    }

    const emailEnabled = checkEmailConfig();
    const userCreatedAtTimestamp = Math.floor(new Date(user.createdAt).getTime() / 1000);

    if (
      !emailEnabled &&
      !user.emailVerified &&
      userCreatedAtTimestamp < verificationEnabledTimestamp
    ) {
      await updateUser(user._id, { emailVerified: true });
      user.emailVerified = true;
    }

    const unverifiedAllowed = isEnabled(process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN);
    if (user.expiresAt && unverifiedAllowed) {
      await updateUser(user._id, {});
    }

    if (!user.emailVerified && !unverifiedAllowed) {
      logError('Passport Local Strategy - Email not verified', { account: raw });
      logger.error(`[Login] [Login failed] [Account: ${raw}] [Request-IP: ${req.ip}]`);
      return done(null, user, { message: 'Email not verified.' });
    }

    logger.info(`[Login] [Login successful] [Account: ${raw}] [Request-IP: ${req.ip}]`);
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}

function logError(title, parameters) {
  const entries = Object.entries(parameters).map(([name, value]) => ({ name, value }));
  logger.error(title, { parameters: entries });
}

module.exports = () =>
  new PassportLocalStrategy(
    {
      usernameField: 'email', // 表单字段名仍叫 email(值可为用户名或邮箱),不改前端字段名
      passwordField: 'password',
      session: false,
      passReqToCallback: true,
    },
    passportLogin,
  );

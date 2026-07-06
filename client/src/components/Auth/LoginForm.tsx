/* fork 版 LoginForm.tsx —— 覆盖 LibreChat 的 client/src/components/Auth/LoginForm.tsx。
 * 在官方版基础上加三处(均已标注 LSS-FORK):
 *   ① 用户名/邮箱恒可登(useUsernameLogin=true;配套后端 localStrategy fork + loginSchema 放宽)。
 *   ② 密码框下加"登录身份"下拉(使用者/开发者)。
 *   ③ 登录成功(user 就位)后,按 LibreChat 用户 id 调 LSS authMode.mintByLibre 铸模式令牌 → sciChat 按模式出工具。
 * 构建:放回原路径 → npm run frontend。网关地址用 Vite env VITE_LSS_GATEWAY(build 时设),缺省 /api/call(同源反代时)。
 * 说明:目标是官方主线版;你那版若结构不同,以这三处为准移植即可。 */
import React, { useState, useEffect, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@marsidev/react-turnstile';
import { ThemeContext, SecretInput, Spinner, Button, isDark } from '@librechat/client';
import type { TLoginUser, TStartupConfig } from 'librechat-data-provider';
import type { TAuthContext } from '~/common';
import { useResendVerificationEmail } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { validateEmail } from '~/utils';
import { useLocalize } from '~/hooks';

type TLoginFormProps = {
  onSubmit: (data: TLoginUser) => void;
  startupConfig: TStartupConfig;
  error: Pick<TAuthContext, 'error'>['error'];
  setError: Pick<TAuthContext, 'setError'>['setError'];
};

const LSS_GATEWAY =
  ((import.meta as unknown as { env?: { VITE_LSS_GATEWAY?: string } }).env?.VITE_LSS_GATEWAY) ||
  '/api/call';

// LSS-FORK ①':按【部署域名】决定是 scisyChat(平台版,4 身份)还是 sciChat(普通版,2 身份)。
// 同一镜像、两个域名即可区分;改这里的关键字 'scisy' 即可换判定规则;测试可用 ?platform=1 覆盖。
const LSS_PLATFORM_KEYWORD = 'scisy';
function isPlatformDeploy(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('platform') === '1') return true;
    return new RegExp(LSS_PLATFORM_KEYWORD, 'i').test(window.location.hostname);
  } catch (e) {
    return false;
  }
}
const LSS_ROLE_OPTIONS_PLATFORM = [
  { value: 'user', label: '使用者(使用 / 填写)' },
  { value: 'developer', label: '开发者(可改 App / 网页 / 软件)' },
  { value: 'reviewer', label: '审核员(只审核)' },
  { value: 'super_admin', label: '超级管理员(后台数据)' },
];
const LSS_ROLE_OPTIONS_BASIC = LSS_ROLE_OPTIONS_PLATFORM.slice(0, 2);

const LoginForm: React.FC<TLoginFormProps> = ({ onSubmit, startupConfig, error, setError }) => {
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const { user } = useAuthContext(); // LSS-FORK: 登录成功后拿到当前用户,用于铸模式令牌
  const {
    register,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TLoginUser>();
  const [showResendLink, setShowResendLink] = useState<boolean>(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // LSS-FORK: 登录身份。使用者/开发者是"模式"(authMode);审核员/超管是账号后端角色(devAccess),下拉里为标签,
  //   实际权限由后端定——mintByLibre 只把 developer 记为开发者模式,其余(含审核员/超管选项)按 user。
  const [loginMode, setLoginMode] = useState<string>('user');

  // LSS-FORK ①:用户名或邮箱都能登(后端 localStrategy 已支持;true 时本组件跳过邮箱格式校验)
  const useUsernameLogin = true;
  const validTheme = isDark(theme) ? 'dark' : 'light';
  const requireCaptcha = Boolean(startupConfig.turnstile?.siteKey);
  const authInputClassName =
    'webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-green-500 focus:outline-none focus-visible:border-green-500';
  const authSecretInputClassName = `${authInputClassName} h-auto pr-12`;
  const authLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-600 dark:peer-focus:text-green-500 rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4';
  const authSecretButtonClassName =
    'size-9 rounded-xl text-text-secondary-alt hover:bg-transparent hover:text-text-primary';

  useEffect(() => {
    if (error && error.includes('422') && !showResendLink) {
      setShowResendLink(true);
    }
  }, [error, showResendLink]);

  // LSS-FORK ③:登录成功(user 就位)且有待写模式 → 按 LibreChat 用户 id 铸 LSS 模式令牌(免密码,经 sciUserMap 解析)
  useEffect(() => {
    const pending = typeof window !== 'undefined' ? localStorage.getItem('lss_pending_mode') : null;
    const libreId = (user as unknown as { id?: string })?.id;
    if (libreId && pending) {
      fetch(LSS_GATEWAY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'authMode', data: { action: 'mintByLibre', libreId, mode: pending } }),
      })
        .catch(() => {})
        .finally(() => {
          try {
            localStorage.setItem('lss_login_mode', pending);
            localStorage.removeItem('lss_pending_mode');
          } catch (e) {
            /* noop */
          }
        });
    }
  }, [user]);

  const resendLinkMutation = useResendVerificationEmail({
    onMutate: () => {
      setError(undefined);
      setShowResendLink(false);
    },
  });

  if (!startupConfig) {
    return null;
  }

  const renderError = (fieldName: string) => {
    const errorMessage = errors[fieldName]?.message;
    return errorMessage ? (
      <span role="alert" className="mt-1 text-sm text-red-600 dark:text-red-500">
        {String(errorMessage)}
      </span>
    ) : null;
  };

  const handleResendEmail = () => {
    const email = getValues('email');
    if (!email) {
      return setShowResendLink(false);
    }
    resendLinkMutation.mutate({ email });
  };

  return (
    <>
      {showResendLink && (
        <div className="mt-2 rounded-md border border-green-500 bg-green-500/10 px-3 py-2 text-sm text-gray-600 dark:text-gray-200">
          {localize('com_auth_email_verification_resend_prompt')}
          <button
            type="button"
            className="ml-2 text-blue-600 hover:underline"
            onClick={handleResendEmail}
            disabled={resendLinkMutation.isLoading}
          >
            {localize('com_auth_email_resend_link')}
          </button>
        </div>
      )}
      <form
        className="mt-6"
        aria-label="Login form"
        method="POST"
        onSubmit={handleSubmit((data) => {
          // LSS-FORK ②:提交时暂存所选模式,登录成功后由上面的 effect 铸令牌
          try {
            localStorage.setItem('lss_pending_mode', loginMode);
          } catch (e) {
            /* noop */
          }
          onSubmit(data);
        })}
      >
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              id="email"
              autoComplete={useUsernameLogin ? 'username' : 'email'}
              aria-label={localize('com_auth_email')}
              {...register('email', {
                required: localize('com_auth_email_required'),
                maxLength: { value: 120, message: localize('com_auth_email_max_length') },
                validate: useUsernameLogin
                  ? undefined
                  : (value) => validateEmail(value, localize('com_auth_email_pattern')),
              })}
              aria-invalid={!!errors.email}
              className={authInputClassName}
              placeholder=" "
            />
            <label htmlFor="email" className={authLabelClassName}>
              用户名或邮箱
            </label>
          </div>
          {renderError('email')}
        </div>
        <div className="mb-2">
          <div className="relative">
            <SecretInput
              id="password"
              autoComplete="current-password"
              aria-label={localize('com_auth_password')}
              {...register('password', {
                required: localize('com_auth_password_required'),
                minLength: {
                  value: startupConfig?.minPasswordLength || 8,
                  message: localize('com_auth_password_min_length'),
                },
                maxLength: { value: 128, message: localize('com_auth_password_max_length') },
              })}
              aria-invalid={!!errors.password}
              className={authSecretInputClassName}
              placeholder=" "
              label={localize('com_auth_password')}
              labelClassName={authLabelClassName}
              controlsClassName="right-2"
              buttonClassName={authSecretButtonClassName}
            />
          </div>
          {renderError('password')}
        </div>

        {/* LSS-FORK ②:登录身份(模式)。选项按域名 2/4(scisyChat 平台版 4 项,sciChat 普通版 2 项)。
            开发者模式才有 App 生杀大权;审核员/超管为后端角色标签,选它不改变账号实际角色。 */}
        <div className="mb-2">
          <label htmlFor="lss-login-mode" className="mb-1 block text-sm text-text-secondary-alt">
            登录身份
          </label>
          <select
            id="lss-login-mode"
            value={loginMode}
            onChange={(e) => setLoginMode(e.target.value)}
            className={authInputClassName}
          >
            {(isPlatformDeploy() ? LSS_ROLE_OPTIONS_PLATFORM : LSS_ROLE_OPTIONS_BASIC).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {startupConfig.passwordResetEnabled && (
          <a
            href="/forgot-password"
            className="inline-flex p-1 text-sm font-medium text-green-600 underline decoration-transparent transition-all duration-200 hover:text-green-700 hover:decoration-green-700 focus:text-green-700 focus:decoration-green-700 dark:text-green-500 dark:hover:text-green-400 dark:hover:decoration-green-400 dark:focus:text-green-400 dark:focus:decoration-green-400"
          >
            {localize('com_auth_password_forgot')}
          </a>
        )}

        {requireCaptcha && (
          <div className="my-4 flex justify-center">
            <Turnstile
              siteKey={startupConfig.turnstile!.siteKey}
              options={{
                ...startupConfig.turnstile!.options,
                theme: validTheme,
              }}
              onSuccess={setTurnstileToken}
              onError={() => setTurnstileToken(null)}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
        )}

        <div className="mt-6">
          <Button
            aria-label={localize('com_auth_continue')}
            data-testid="login-button"
            type="submit"
            disabled={(requireCaptcha && !turnstileToken) || isSubmitting}
            variant="submit"
            className="h-12 w-full rounded-2xl"
          >
            {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
          </Button>
        </div>
      </form>
    </>
  );
};

export default LoginForm;

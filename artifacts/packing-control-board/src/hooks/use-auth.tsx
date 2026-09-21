import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  type AuthUser,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from 'react';

type AuthContextValue = {
  user: AuthUser;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }

  if (
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    typeof error.response.status === 'number'
  ) {
    return error.response.status;
  }

  return undefined;
}

function logout(): void {
  const form = document.createElement('form');

  form.method = 'POST';
  form.action = '/api/auth/logout';
  form.target = window.self === window.top ? '_self' : '_blank';

  document.body.appendChild(form);
  form.submit();
  form.remove();

  if (window.self !== window.top) {
    window.setTimeout(() => window.location.reload(), 1_000);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const currentUserQuery = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    },
  });

  useEffect(() => {
    const handleUnauthorized = () => {
      const queryKey = getGetCurrentUserQueryKey();

      if (queryClient.getQueryData(queryKey)) {
        void queryClient.resetQueries({ queryKey });
      }
    };

    window.addEventListener('api:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener(
        'api:unauthorized',
        handleUnauthorized,
      );
    };
  }, [queryClient]);

  if (currentUserQuery.isPending) {
    return (
      <LoginShell
        title="Checking access"
        message="Verifying your Packing Control Board session…"
      />
    );
  }

  if (currentUserQuery.isError) {
    const isUnauthenticated =
      getErrorStatus(currentUserQuery.error) === 401;

    return (
      <LoginShell
        title={
          isUnauthenticated
            ? 'Sign in required'
            : 'Access check unavailable'
        }
        message={
          isUnauthenticated
            ? 'Use your Microsoft work account to open the Packing Control Board.'
            : 'Your session could not be verified. Retry the access check.'
        }
      >
        {isUnauthenticated ? (
          <>
            <a
              href="/api/auth/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
            >
              Sign in with Microsoft
            </a>

            <button
              type="button"
              onClick={() => void currentUserQuery.refetch()}
              className="text-xs font-semibold text-muted-foreground hover:text-primary"
            >
              I’ve signed in — check again
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void currentUserQuery.refetch()}
            className="rounded-sm border border-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-primary hover:bg-primary hover:text-primary-foreground"
          >
            Retry
          </button>
        )}
      </LoginShell>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user: currentUserQuery.data,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}

function LoginShell({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md border border-border bg-card p-7 shadow-2xl">
        <div className="mb-5 h-1 w-16 bg-primary" />

        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
          Packing Control Board
        </div>

        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {title}
        </h1>

        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {message}
        </p>

        {children && (
          <div className="mt-6 flex flex-col gap-3">
            {children}
          </div>
        )}
      </section>
    </main>
  );
}
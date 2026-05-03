import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Platform } from "react-native";

interface AuthContextValue {
  isAuthenticated: boolean;
  isAuthAvailable: boolean;
  authenticate: () => Promise<boolean>;
  lock: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isAuthAvailable: false,
  authenticate: async () => false,
  lock: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthAvailable, setIsAuthAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      setIsAuthenticated(true);
      setIsAuthAvailable(false);
      return;
    }
    (async () => {
      try {
        const LocalAuth = await import("expo-local-authentication");
        const hasHardware = await LocalAuth.hasHardwareAsync();
        const isEnrolled = await LocalAuth.isEnrolledAsync();
        const available = hasHardware && isEnrolled;
        setIsAuthAvailable(available);
        if (!available) {
          setIsAuthenticated(true);
        }
      } catch {
        setIsAuthenticated(true);
      }
    })();
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web" || !isAuthAvailable) {
      setIsAuthenticated(true);
      return true;
    }
    try {
      const LocalAuth = await import("expo-local-authentication");
      const result = await LocalAuth.authenticateAsync({
        promptMessage: "Unlock My Vault",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch {
      setIsAuthenticated(true);
      return true;
    }
  }, [isAuthAvailable]);

  const lock = useCallback(() => {
    if (Platform.OS !== "web") {
      setIsAuthenticated(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isAuthAvailable, authenticate, lock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

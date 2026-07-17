import { createContext, type ReactNode, useContext } from "react";

const ScorecardRenderScaleContext = createContext(1);

interface ScorecardRenderScaleProviderProps {
  children: ReactNode;
  scale: number;
}

export function ScorecardRenderScaleProvider({
  children,
  scale,
}: ScorecardRenderScaleProviderProps) {
  return (
    <ScorecardRenderScaleContext.Provider value={Math.max(0.01, scale)}>
      {children}
    </ScorecardRenderScaleContext.Provider>
  );
}

export function useScorecardRenderScale() {
  return useContext(ScorecardRenderScaleContext);
}

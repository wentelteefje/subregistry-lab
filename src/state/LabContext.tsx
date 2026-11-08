import { useAccount, useChainId } from "wagmi";
import { getDeployment } from "../config/deployments";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  labReducer,
  loadState,
  saveState,
  type ScopedLabAction,
  type LabState,
  type SessionData,
} from "./labSession";

type LabContextValue = {
  state: LabState;
  session?: SessionData;
  dispatch: Dispatch<ScopedLabAction>;
  getState: () => LabState;
};

const LabContext = createContext<LabContextValue | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(loadState);
  const current = useRef(state);
  const getState = useCallback(() => current.current, []);
  const dispatch = useCallback((action: ScopedLabAction) => {
    current.current = labReducer(current.current, action);
    saveState(current.current);
    setState(current.current);
  }, []);

  const { address } = useAccount();
  const chainId = useChainId();
  const selected = state.activeKey ? state.sessions[state.activeKey] : undefined;
  const session = selected?.wallet === address?.toLowerCase() && selected?.deploymentSet === getDeployment(chainId === 1 ? 1 : 11155111).deploymentSet ? selected : undefined;

  return (
    <LabContext.Provider value={{ state, session, dispatch, getState }}>
      {children}
    </LabContext.Provider>
  );
}

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used inside LabProvider");
  return ctx;
}

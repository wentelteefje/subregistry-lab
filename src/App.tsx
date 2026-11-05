import { useAccount, useChainId } from "wagmi";
import { Agentation } from "agentation";
import { Route, Routes } from "react-router-dom";
import "./App.css";
import LabPage from "./pages/LabPage";
import { LabProvider } from "./state/LabContext";

/**
 * Root app. Single page: the subregistry lab wizard.
 * Agentation toolbar (dev only) for visual annotations synced to the agent via MCP.
 */
function App() {
  const { address } = useAccount();
  const chainId = useChainId();
  return (
    // w-full, not w-screen: 100vw includes the scrollbar -> horizontal overflow
    <div className="min-h-screen w-full">
      <LabProvider>
        <Routes key={`${chainId}:${address}`}>
          <Route path="/" element={<LabPage />} />
        </Routes>
      </LabProvider>
      {import.meta.env.DEV && <Agentation />}
    </div>
  );
}

export default App;

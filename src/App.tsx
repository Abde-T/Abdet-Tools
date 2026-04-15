import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import TimelinePage from "./pages/TimelinePage";
import Sidebar from "./components/layout/Sidebar";

function App() {
  return (
    <Router>
      <div className="flex min-h-screen bg-[#0a0a0b]">
        {/* Sidebar stays fixed on the left */}
        <Sidebar />
        
        {/* Main Content Area */}
        <main className="flex-1 relative overflow-hidden">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/timeline" element={<TimelinePage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

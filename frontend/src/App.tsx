import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import RaceReplay from "./pages/RaceReplay";
import SeasonOverview from "./pages/SeasonOverview";
import DriverAnalysis from "./pages/DriverAnalysis";
import QualifyingAnalysis from "./pages/QualifyingAnalysis";
import About from "./pages/About";

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/" element={<RaceReplay />} />
                    <Route path="/season" element={<SeasonOverview />} />
                    <Route path="/driver" element={<DriverAnalysis />} />
                    <Route
                        path="/qualifying"
                        element={<QualifyingAnalysis />}
                    />
                    <Route path="/about" element={<About />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import Auth from "./pages/Auth";


export function App() {
    return (
    <div>
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth/>}/>
        <Route path="/" element={<Dashboard/>}/>
      </Routes>
    </BrowserRouter>
    </div>
    );   
}

export default App;

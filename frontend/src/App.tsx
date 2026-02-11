import { Routes, Route } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Landing from '@/pages/Landing';
import CreateEscrow from '@/pages/CreateEscrow';
import MyEscrows from '@/pages/MyEscrows';
import EscrowDetailPage from '@/pages/EscrowDetailPage';
import CreateSwap from '@/pages/CreateSwap';
import MySwaps from '@/pages/MySwaps';
import SwapDetailPage from '@/pages/SwapDetailPage';

export default function App() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <Navbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<CreateEscrow />} />
        <Route path="/escrows" element={<MyEscrows />} />
        <Route path="/escrow/:id" element={<EscrowDetailPage />} />
        <Route path="/swap/create" element={<CreateSwap />} />
        <Route path="/swaps" element={<MySwaps />} />
        <Route path="/swap/:id" element={<SwapDetailPage />} />
      </Routes>
    </div>
  );
}

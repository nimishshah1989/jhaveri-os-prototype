import type { Metadata } from 'next';
import { TopNav } from '../components/TopNav';
import { DensityToggle } from '../components/DensityToggle';
import { density } from '../lib/density';
import { dmy } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jhaveri OS',
  description: 'Broker operating system — prototype',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Painted on the root so one attribute governs every disclosure on every page,
  // rather than each component deciding for itself what "open" means.
  const detail = await density();
  return (
    <html lang="en" data-density={detail}>
      <body>
        <div className="topbar">
          <span className="brand">Jhaveri OS</span>
          <TopNav />
          <DensityToggle />
          <span className="who">
            <b>Ravi Shankar Vyas</b> · Broker
            <br />
            Feeds as of {dmy(TODAY)} · FIFO complete
          </span>
        </div>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}

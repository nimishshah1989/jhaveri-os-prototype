import type { Metadata } from 'next';
import { TopNav } from '../components/TopNav';
import { dmy } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jhaveri OS',
  description: 'Broker operating system — prototype',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <div className="topbar">
          <span className="brand">Jhaveri OS</span>
          <TopNav />
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

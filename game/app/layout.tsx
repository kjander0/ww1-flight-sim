import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Super Flight WW1', description: 'A low-poly WW1 flight simulator with an interactive cockpit.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

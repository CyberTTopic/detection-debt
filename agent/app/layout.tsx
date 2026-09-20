import type {Metadata} from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Detection Debt',
  description:
    'Ask what stops being detected when a telemetry source goes away. Answers come from a ' +
    'Sanity content graph of connectors, log tables, detection rules and MITRE ATT&CK techniques.',
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

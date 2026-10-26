'use client';
import { ErrorNotice } from '../../components/feedback';
export default function ErrorPage({ reset }: { reset: () => void }) { return <ErrorNotice message="This page could not load. Please try again." retry={reset} />; }

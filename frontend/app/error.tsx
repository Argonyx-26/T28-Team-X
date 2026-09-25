"use client";

import { useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    if (typeof window !== "undefined" && "reportError" in window) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).reportError(error);
    }
  }, [error]);

  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-md border-red-pen/20 shadow-sm">
        <CardHeader>
          <CardTitle className="text-red-pen">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            We encountered an unexpected error. Our team has been notified.
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={reset} variant="default" className="w-full">
            Try again
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

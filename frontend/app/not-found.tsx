import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            We could not find the page you were looking for.
          </p>
        </CardContent>
        <CardFooter>
          <Button render={<Link href="/" />} variant="default" className="w-full">
            Return Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

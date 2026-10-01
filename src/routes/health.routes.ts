import { Router, Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.js";
import { gcsService } from "../gcs/gcs.service.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  ApiResponse.success(res, { status: "ok" }, 200);
});

router.get("/gcs", async (_req: Request, res: Response) => {
  const isHealthy = await gcsService.verifyBucketAccess();
  if (isHealthy) {
    ApiResponse.success(res, { status: "ok", gcs: "connected" }, 200);
  } else {
    ApiResponse.error(res, "GCS Unreachable", 503, {
      status: "error",
      gcs: "unreachable",
    });
  }
});

export const healthRouter: Router = router;

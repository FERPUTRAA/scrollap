import { Router, type IRouter } from "express";
import healthRouter from "./health";
import liveRouter from "./live";
import vavaRouter from "./vava";

const router: IRouter = Router();

router.use(healthRouter);
router.use(liveRouter);
router.use(vavaRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import liveRouter from "./live";
import vidiocallRouter from "./vidiocall";

const router: IRouter = Router();

router.use(healthRouter);
router.use(liveRouter);
router.use(vidiocallRouter);

export default router;

import { Router } from "express";
import { orderController } from "../modules/orders/order.controller.js";

const router = Router();

router.get("/", orderController.getOrders);

router.get("/:orderId", orderController.getOrderById);

router.post("/", orderController.uploadOrders);

export const orderRouter: Router = router;

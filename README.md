# 手摇风琴纸带打孔API

纯后端零依赖Node服务，使用 `data/db.json` 持久化曲目、纸带区间和试奏问题。

## 启动

```bash
PORT=3019 node server.js
```

## 主要接口

- `GET /health`
- `GET /tunes`
- `POST /tunes`
- `GET /tunes/:id/progress`
- `GET /tunes/:id/sections`
- `POST /tunes/:id/sections`
- `GET /tunes/:id/unchecked-sections`
- `PATCH /sections/:id/check`
- `GET /issues?tuneId=&status=`
- `POST /issues`
- `PATCH /issues/:id/status`
- `GET /rework-orders?tuneId=&status=`
- `POST /rework-orders`
- `PATCH /rework-orders/:id/review`
- `POST /rework-orders/archive`

## 错孔返工闭环

返工单状态：`pending_review`（待复核）→ `approved`（复核通过）→ `archived`（已归档），另有 `rejected`（已退回）、`invalidated`（已失效）。

- `POST /rework-orders` 为曲目问题建单，`issueIds` 可含同一区间的多个问题；跨区间或含已结案问题整单拒绝（400），同一问题已有待复核单时冲突（409）。建单后问题仍计未解决，所属区间转为待校对。
- `PATCH /rework-orders/:id/review` 复核：`{"result":"approved"}` 通过才结案（问题置 resolved）；`{"result":"rejected","reason":"..."}` 退回须填原因，问题与区间保持原状态。已失效单可重新复核。
- 登记新问题会让同曲目中已通过但未归档的返工单失效，须重新复核。
- `POST /rework-orders/archive` 批量归档（可按 `tuneId` 或 `ids` 过滤），只处理已复核通过且未失效的记录。
- 进度接口 `GET /tunes/:id/progress` 的 `rework` 字段同步返工统计，所有数据写回 `data/db.json`。

## 闭环示例

```bash
curl http://127.0.0.1:3019/tunes/tune_demo/progress
curl -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","sectionId":"section_demo_2","type":"错孔","beat":45,"lane":9,"description":"第45拍第9轨多打孔"}'
curl -X POST http://127.0.0.1:3019/rework-orders \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","issueIds":["issue_demo"],"note":"重新打孔"}'
curl -X PATCH http://127.0.0.1:3019/rework-orders/<id>/review \
  -H 'Content-Type: application/json' \
  -d '{"result":"approved"}'
curl -X POST http://127.0.0.1:3019/rework-orders/archive \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo"}'
```

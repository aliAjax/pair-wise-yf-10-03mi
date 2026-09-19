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

1. `POST /rework-orders` 为一首曲目的同区间问题建返工单：`{"tuneId":"...","issueIds":["issue_1","issue_2"],"note":"..."}`。
   - 同一问题只允许一张待复核单；跨区间、问题已结案或问题不属于该曲目时整单拒绝，不落库。
   - 建单后问题仍计未解决，所属区间自动转为待校对（`checked=false`）。
2. `PATCH /rework-orders/:id/review` 复核：`{"result":"approve"}` 通过才把单内问题结案（`resolved`）；`{"result":"reject","reason":"..."}` 退回必须填原因，问题保持原状态。
3. 新增问题（`POST /issues`）会让同曲目已通过但未归档的返工单失效（`invalidated=true`），需重新复核。
4. `POST /rework-orders/archive` 批量归档，只处理已复核通过且未失效的单，可按 `tuneId` 或 `ids` 过滤。
5. `GET /tunes/:id/progress` 的 `rework` 字段同步返工统计，全部写回 `data/db.json`。

## 闭环示例

```bash
curl http://127.0.0.1:3019/tunes/tune_demo/progress
curl -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","sectionId":"section_demo_2","type":"错孔","beat":45,"lane":9,"description":"第45拍第9轨多打孔"}'
curl -X POST http://127.0.0.1:3019/rework-orders \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","issueIds":["issue_demo"],"note":"重新打孔第41拍"}'
curl -X PATCH http://127.0.0.1:3019/rework-orders/<id>/review \
  -H 'Content-Type: application/json' \
  -d '{"result":"approve"}'
curl -X POST http://127.0.0.1:3019/rework-orders/archive \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo"}'
```

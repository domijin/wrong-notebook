# OCI Always Free A1（Resource Manager 重试）

San Jose 的 `VM.Standard.A1.Flex` 经常 `Out of capacity`。控制台会话还会自动登出。更稳的做法是：**Save as stack**，在 **Cloud Shell** 里定时 Apply。

## 当前 stack

| 项 | 值 |
|----|-----|
| Name | `instance-20261107-1120` |
| Region | `us-sanjose-1` |
| Stack OCID | `ocid1.ormstack.oc1.us-sanjose-1.amaaaaaas7aq4diax3z2x64jn3tjgy66ci5yirqu2rurqezl4dx5udibsdaq` |
| Shape | A1.Flex **1 OCPU / 6 GB**（建好后可改成 2/12） |
| Image | Canonical Ubuntu 24.04 |
| Subnet | `subnet-20261105-2151` |
| SSH | 两把 ed25519（icloud + macbook-life） |

### 注意：Public IP

Save as stack 时配置里是 **`assignPublicIp: false`**。实例建好后若不能 SSH：

1. 控制台打开该实例 → **Attached VNICs** → 编辑 VNIC → 分配 **Ephemeral public IP**，或  
2. 编辑 stack 的 Terraform，把 `assign_public_ip` 改成 `true` 后再 Apply。

## Cloud Shell 轻量重试

1. 控制台右上角打开 **Cloud Shell**
2. 上传或粘贴 `cloud-shell-apply-until-capacity.sh`
3. 运行：

```bash
chmod +x cloud-shell-apply-until-capacity.sh
./cloud-shell-apply-until-capacity.sh
```

默认：**每约 30 分钟** Apply 一次，最多 48 次（约 24 小时）；只对 capacity 错误重试。

常用覆盖：

```bash
INTERVAL_SEC=3600 MAX_ATTEMPTS=24 ./cloud-shell-apply-until-capacity.sh   # 每小时
STACK_ID=ocid1.ormstack... ./cloud-shell-apply-until-capacity.sh          # 换 stack
```

一次性手动 Apply：

```bash
oci resource-manager job create-apply-job \
  --stack-id ocid1.ormstack.oc1.us-sanjose-1.amaaaaaas7aq4diax3z2x64jn3tjgy66ci5yirqu2rurqezl4dx5udibsdaq \
  --execution-plan-strategy AUTO_APPROVED \
  --region us-sanjose-1
```

可选：先看容量（有也不保证立刻能开）：

```bash
# 先查 AD 名
oci iam availability-domain list --compartment-id <tenancy_ocid> --region us-sanjose-1
```

## 建好之后

1. 确认有 Public IP（或装好 Tailscale）
2. `ssh -i <key> ubuntu@<public-ip>`（Ubuntu 用户一般是 `ubuntu`）
3. 需要时把 shape 改成 **2 OCPU / 12 GB**
4. 按仓库 `deploy/README.md` 部署 wrong-notebook

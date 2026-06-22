# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# FreelanceEscrow — AI-powered freelance escrow on GenLayer
# Flow: create_job → fund_job (payable) → submit_work → verify_and_release → paid
# AI validators fetch the deliverable URL and verify it meets the job description
# Payment is auto-released to freelancer if approved, stays locked if rejected
# gl.message_raw["datetime"] for timestamps — NOT gl.message.datetime
# Storage writes and emit_transfer MUST be OUTSIDE nondet blocks
# u256 for all GEN amounts


def _safe_json(text: str) -> dict:
    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```")[1]
            if s.startswith("json"):
                s = s[4:]
        return json.loads(s.strip())
    except:
        return {}


# Required for sending GEN to EOA wallets (external chain layer)
@gl.evm.contract_interface
class _EOARecipient:
    class View:
        pass
    class Write:
        pass


class FreelanceEscrow(gl.Contract):
    # job_id (str) -> JSON string of job record
    jobs: TreeMap[str, str]
    # job_id -> locked GEN amount in wei (stored as str)
    escrow_balances: TreeMap[str, str]
    # total jobs ever created
    job_count: str
    # total GEN paid out through the protocol
    total_paid: str

    def __init__(self):
        self.job_count = "0"
        self.total_paid = "0"

    # ── WRITE METHODS ──────────────────────────────────────────────────────────

    @gl.public.write
    def create_job(
        self,
        title: str,
        description: str,
        freelancer: str,
        deadline: str,
    ) -> None:
        """
        Client creates a job. Escrow is funded separately via fund_job.
        freelancer: wallet address of the freelancer (0x...)
        deadline: human-readable deadline e.g. '2026-07-01'
        """
        client = str(gl.message.sender_address)
        now_str = gl.message_raw["datetime"]

        assert len(title) >= 3 and len(title) <= 100, (
            "Title must be 3-100 characters."
        )
        assert len(description) >= 20, (
            "Description too short. Provide at least 20 characters."
        )
        assert len(freelancer) == 42 and freelancer.startswith("0x"), (
            "Invalid freelancer address. Must be a 0x... wallet address."
        )
        assert client.lower() != freelancer.lower(), (
            "Client and freelancer cannot be the same address."
        )

        try:
            count = int(self.job_count) + 1
        except:
            count = 1

        job_id = str(count)

        record = json.dumps({
            "job_id": job_id,
            "title": title[:100].replace('"', "'"),
            "description": description[:1000].replace('"', "'"),
            "client": client,
            "freelancer": freelancer,
            "deadline": deadline.replace('"', "'"),
            "status": "OPEN",
            "created_at": now_str,
            "funded_at": "",
            "submitted_at": "",
            "resolved_at": "",
            "deliverable_url": "",
            "ai_verdict": "",
            "ai_reasoning": "",
        })

        self.jobs[job_id] = record
        self.escrow_balances[job_id] = "0"
        self.job_count = job_id

    @gl.public.write.payable
    def fund_job(self, job_id: str) -> None:
        """
        Client locks GEN into escrow. GEN is held in the contract until
        the job is verified and paid, or refunded.
        """
        amount = gl.message.value
        assert amount > u256(0), "Must send GEN to fund the job."

        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), (
            "Only the client can fund this job."
        )
        assert record["status"] == "OPEN", (
            "Job must be OPEN to fund. Current status: " + record["status"]
        )

        now_str = gl.message_raw["datetime"]
        record["status"] = "FUNDED"
        record["funded_at"] = now_str
        self.jobs[job_id] = json.dumps(record)

        current = int(self.escrow_balances.get(job_id, "0"))
        self.escrow_balances[job_id] = str(current + int(amount))

    @gl.public.write
    def submit_work(self, job_id: str, deliverable_url: str) -> None:
        """
        Freelancer submits completed work as a URL.
        This can be a GitHub repo, deployed app, Google Drive link,
        Figma file, written doc — anything publicly accessible.
        """
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["freelancer"].lower() == sender.lower(), (
            "Only the assigned freelancer can submit work."
        )
        assert record["status"] == "FUNDED", (
            "Job must be FUNDED before submission. Current status: " + record["status"]
        )
        assert len(deliverable_url) >= 10 and deliverable_url.startswith("http"), (
            "Provide a valid public URL starting with http."
        )

        now_str = gl.message_raw["datetime"]
        record["status"] = "SUBMITTED"
        record["deliverable_url"] = deliverable_url[:500].replace('"', "'")
        record["submitted_at"] = now_str
        self.jobs[job_id] = json.dumps(record)

    @gl.public.write
    def verify_and_release(self, job_id: str) -> None:
        """
        AI validators fetch the deliverable URL, read its content,
        and verify whether the work meets the job description.

        If APPROVED: GEN is automatically released to the freelancer.
        If REJECTED: job moves to DISPUTED. Client can then refund.

        This is the core GenLayer innovation — AI judgment on real deliverables,
        verified by 5 independent validators reaching consensus.
        """
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), (
            "Only the client can trigger verification."
        )
        assert record["status"] == "SUBMITTED", (
            "Job must be SUBMITTED to verify. Current status: " + record["status"]
        )

        title = record["title"]
        description = record["description"]
        deliverable_url = record["deliverable_url"]
        freelancer = record["freelancer"]

        # ── NONDET BLOCK: fetch deliverable + AI verdict ───────────────────────
        # Web fetch and LLM call must be inside the function passed to nondet.
        # Storage writes and emit_transfer happen AFTER this returns.

        def _fetch_and_evaluate() -> str:
            # Fetch deliverable content — may fail if URL is private/broken
            fetched = ""
            try:
                response = gl.nondet.web.get(deliverable_url)
                fetched = response.body.decode("utf-8")[:4000]
            except:
                fetched = ""

            prompt_input = (
                "JOB TITLE: " + title + "\n\n"
                "JOB DESCRIPTION: " + description + "\n\n"
                "DELIVERABLE URL: " + deliverable_url + "\n\n"
                "DELIVERABLE CONTENT (fetched):\n" +
                (fetched if fetched else "[Could not fetch content — evaluate based on URL and context only]")
            )
            return prompt_input

        verdict_raw = gl.eq_principle.prompt_non_comparative(
            _fetch_and_evaluate,
            task=(
                "You are an impartial AI arbitrator for a freelance escrow system on GenLayer.\n"
                "Evaluate whether the submitted deliverable meets the job requirements.\n\n"
                "APPROVE if:\n"
                "- The deliverable is accessible and contains real work\n"
                "- The work is relevant to the job title and description\n"
                "- The scope and quality are reasonable for what was asked\n\n"
                "REJECT if:\n"
                "- The URL is broken, empty, or clearly unrelated to the job\n"
                "- The deliverable has no meaningful content\n"
                "- The work is entirely off-scope\n\n"
                "Be fair but realistic. Freelancers should be paid for real work.\n"
                "Reply ONLY with valid JSON — no other text."
            ),
            criteria=(
                "Validate format only. Accept if: "
                "(1) valid JSON object, "
                "(2) 'approved' field is exactly true or false (boolean), "
                "(3) 'reasoning' field is a non-empty string. "
                "No semantic evaluation."
            ),
        )
        # ── END NONDET BLOCK ────────────────────────────────────────────────────

        # All storage writes and transfers happen here in deterministic context
        verdict_data = _safe_json(verdict_raw)
        approved = verdict_data.get("approved", False)
        reasoning = str(verdict_data.get("reasoning", "No reasoning provided.")).replace('"', "'")[:500]

        balance = int(self.escrow_balances.get(job_id, "0"))
        now_str = gl.message_raw["datetime"]

        if approved:
            # ✓ Work approved — pay the freelancer
            record["status"] = "PAID"
            record["ai_verdict"] = "APPROVED"
            record["ai_reasoning"] = reasoning
            record["resolved_at"] = now_str
            self.jobs[job_id] = json.dumps(record)
            self.escrow_balances[job_id] = "0"

            try:
                self.total_paid = str(int(self.total_paid) + balance)
            except:
                self.total_paid = str(balance)

            # Send GEN to freelancer's EOA wallet
            _EOARecipient(Address(freelancer)).emit_transfer(value=u256(balance))
        else:
            # ✗ Work rejected — move to DISPUTED, client can request refund
            record["status"] = "DISPUTED"
            record["ai_verdict"] = "REJECTED"
            record["ai_reasoning"] = reasoning
            record["resolved_at"] = now_str
            self.jobs[job_id] = json.dumps(record)

    @gl.public.write
    def client_refund(self, job_id: str) -> None:
        """
        Client reclaims escrowed GEN after a dispute or from a funded-but-unstarted job.
        Only available when status is DISPUTED or FUNDED.
        """
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), (
            "Only the client can request a refund."
        )
        assert record["status"] in ["DISPUTED", "FUNDED"], (
            "Refund only available for DISPUTED or FUNDED jobs. "
            "Current status: " + record["status"]
        )

        balance = int(self.escrow_balances.get(job_id, "0"))
        assert balance > 0, "No escrowed balance to refund."

        now_str = gl.message_raw["datetime"]
        record["status"] = "REFUNDED"
        record["resolved_at"] = now_str
        self.jobs[job_id] = json.dumps(record)
        self.escrow_balances[job_id] = "0"

        client = record["client"]
        _EOARecipient(Address(client)).emit_transfer(value=u256(balance))

    @gl.public.write
    def cancel_job(self, job_id: str) -> None:
        """Cancel an OPEN job (not yet funded). Only client can cancel."""
        raw = self.jobs.get(job_id, None)
        assert raw is not None, f"Job {job_id} not found."

        record = json.loads(raw)
        sender = str(gl.message.sender_address)

        assert record["client"].lower() == sender.lower(), (
            "Only the client can cancel a job."
        )
        assert record["status"] == "OPEN", (
            "Only OPEN jobs can be cancelled. Current status: " + record["status"]
        )

        record["status"] = "CANCELLED"
        self.jobs[job_id] = json.dumps(record)

    # ── READ METHODS ───────────────────────────────────────────────────────────

    @gl.public.view
    def get_job(self, job_id: str) -> str:
        """Get full job record including escrow balance."""
        raw = self.jobs.get(job_id, None)
        if raw is None:
            return json.dumps({"found": False, "job_id": job_id})
        record = json.loads(raw)
        record["found"] = True
        record["escrow_balance"] = self.escrow_balances.get(job_id, "0")
        return json.dumps(record)

    @gl.public.view
    def get_jobs_by_client(self, client: str) -> str:
        """Get all jobs created by a client address."""
        result = []
        count = 0
        for key in self.jobs.keys():
            if count >= 100:
                break
            try:
                record = json.loads(self.jobs[key])
                if record.get("client", "").lower() == client.lower():
                    record["escrow_balance"] = self.escrow_balances.get(key, "0")
                    result.append(record)
            except:
                pass
            count += 1
        return json.dumps(result)

    @gl.public.view
    def get_jobs_by_freelancer(self, freelancer: str) -> str:
        """Get all jobs assigned to a freelancer address."""
        result = []
        count = 0
        for key in self.jobs.keys():
            if count >= 100:
                break
            try:
                record = json.loads(self.jobs[key])
                if record.get("freelancer", "").lower() == freelancer.lower():
                    record["escrow_balance"] = self.escrow_balances.get(key, "0")
                    result.append(record)
            except:
                pass
            count += 1
        return json.dumps(result)

    @gl.public.view
    def get_stats(self) -> str:
        """Global protocol stats."""
        return json.dumps({
            "total_jobs": self.job_count or "0",
            "total_paid": self.total_paid or "0",
            "contract_balance": str(self.balance),
        })

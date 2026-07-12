"""Direct Mode diagnostics for FreelanceMarket.verify_and_release.

Run with Python 3.12+ and genlayer-test installed.  The tests never use a
network, private key, deployed contract, or the live smoke journal.
"""

import importlib.util
import json
import os
import re
import sys
import unittest
from pathlib import Path


DIRECT_MODE_REQUIREMENTS = (
    "Direct Mode diagnostics require Python 3.12+, pytest, and genlayer-test."
)


def _module_available(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ModuleNotFoundError, AttributeError, ValueError):
        return False


if (
    sys.version_info < (3, 12)
    or not _module_available("pytest")
    or not _module_available("gltest")
    # genlayer-test 0.29.2 exposes Direct Mode here (its pytest11 entry point
    # names gltest.direct.pytest_plugin, not gltest.pytest_plugin).
    or not _module_available("gltest.direct.pytest_plugin")
):
    raise unittest.SkipTest(DIRECT_MODE_REQUIREMENTS)

import pytest

pytest_plugins = (
    ("gltest.direct.pytest_plugin",)
    if os.environ.get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1"
    else ()
)


CONTRACT = Path(__file__).parents[1] / "contracts" / "freelance_market.py"
APPROVAL_DOCUMENT = (Path(__file__).parents[1] / "docs/smoke/approval-deliverable.md").read_text()
GARDENING_DOCUMENT = (Path(__file__).parents[1] / "docs/smoke/rejection-deliverable.txt").read_text()
DELIVERABLE_URL = (
    "https://raw.githubusercontent.com/Manablaq/freelance-escrow/"
    "93b138fb8c2ac4c71b1dce6fef9b9925ebbfbf48/docs/smoke/approval-deliverable.md"
)
ESCROW = 10**18
SDK_RELEASE = "v0.2.12"  # genlayer-test 0.29.2's installed offline fallback

APPROVED = json.dumps({
    "approved": True,
    "score": 92,
    "reason": "The fetched document demonstrates the requested escrow verification flow.",
    "evidence_summary": "The source describes registration, funding, submission, verification, and settlement.",
})
REJECTED = json.dumps({
    "approved": False,
    "score": 3,
    "reason": "The gardening text is unrelated to the requested escrow implementation.",
    "evidence_summary": "The source only discusses soil, compost, watering, and mulch.",
})


def _addr_bytes(address):
    if hasattr(address, "as_bytes"):
        return address.as_bytes
    return bytes(address)


def _balance(vm, address):
    return vm._balances.get(_addr_bytes(address), 0)


def _address(value):
    from genlayer.py.types import Address
    return value if isinstance(value, Address) else Address(value)


def _job(contract):
    return json.loads(contract.get_job("1"))


def _profile(contract, address):
    return json.loads(contract.get_profile(str(_address(address))))


def _install_transfer_accounting(contract, vm):
    """Model EOA transfer accounting omitted by genlayer-test 0.29.2 Direct Mode."""
    module = sys.modules[type(contract).__module__]
    contract_address = vm._contract_address

    class Recipient:
        def __init__(self, address):
            self.address = address

        def emit_transfer(self, *, value):
            amount = int(value)
            recipient = _addr_bytes(self.address)
            assert vm._balances.get(contract_address, 0) >= amount
            vm._balances[contract_address] -= amount
            vm._balances[recipient] = vm._balances.get(recipient, 0) + amount

    module._EOARecipient = Recipient


def _build_state(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.strict_mocks = True
    direct_vm.check_pickling = True
    contract = direct_deploy(str(CONTRACT), sdk_version=SDK_RELEASE)
    _install_transfer_accounting(contract, direct_vm)

    with direct_vm.prank(direct_alice):
        contract.register("client", "Client", "Escrow client", "", "1", "fixed", "", "", "")
    with direct_vm.prank(direct_bob):
        contract.register("freelancer", "Freelancer", "Contract engineer", "Python", "1", "fixed", "", "", "")
    with direct_vm.prank(direct_alice):
        contract.create_job(
            "Document GenLayer escrow verification",
            "Document the complete registration, funding, submission, verification, and settlement flow.",
            str(_address(direct_bob)),
            "2026-12-31",
        )

    # Direct Mode exposes deal/value but does not automatically move payable value.
    direct_vm.deal(direct_alice, ESCROW)
    direct_vm.deal(direct_bob, 0)
    direct_vm.deal(vm_address := vm_contract_address(direct_vm), 0)
    with direct_vm.prank(direct_alice):
        direct_vm.value = ESCROW
        contract.fund_job("1")
        direct_vm.value = 0
    direct_vm._balances[_addr_bytes(direct_alice)] -= ESCROW
    direct_vm._balances[_addr_bytes(vm_address)] += ESCROW
    with direct_vm.prank(direct_bob):
        contract.submit_work("1", DELIVERABLE_URL)
    return contract


def vm_contract_address(vm):
    from genlayer.py.types import Address
    return Address(vm._contract_address)


def _mock_evaluation(vm, body, llm, *, status=200):
    vm.mock_web(re.escape(DELIVERABLE_URL), {"method": "GET", "status": status, "body": body})
    # 0.29.2 auto-parses JSON-looking mocks even though this SDK API returns text.
    # Fencing keeps the mock textual and is explicitly accepted by the contract parser.
    if isinstance(llm, str):
        try:
            json.loads(llm)
            llm = "```json\n" + llm + "\n```"
        except (TypeError, ValueError):
            pass
    vm.mock_llm(r"impartial GenLayer escrow evaluator", llm)


def _assert_no_approval_settlement(contract, vm, freelancer, before_balance):
    job = _job(contract)
    profile = _profile(contract, freelancer)
    assert job["escrow_balance"] == str(ESCROW)
    assert contract.total_paid == "0"
    assert profile["jobs_completed"] == "0"
    assert profile["total_earned"] == "0"
    assert _balance(vm, freelancer) == before_balance


def test_approval_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _build_state(direct_vm, direct_deploy, direct_alice, direct_bob)
    _mock_evaluation(direct_vm, APPROVAL_DOCUMENT, APPROVED)
    before = _balance(direct_vm, direct_bob)
    with direct_vm.prank(direct_alice):
        contract.verify_and_release("1")

    job = _job(contract)
    profile = _profile(contract, direct_bob)
    assert job["ai_verdict"] == "APPROVED"
    assert job["status"] == "PAID"
    assert job["escrow_balance"] == "0"
    assert job["resolved_at"]
    assert contract.total_paid == str(ESCROW)
    assert profile["jobs_completed"] == "1"
    assert profile["total_earned"] == str(ESCROW)
    assert _balance(direct_vm, direct_bob) - before == ESCROW
    assert _balance(direct_vm, vm_contract_address(direct_vm)) == 0


def test_semantic_rejection_preserves_escrow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _build_state(direct_vm, direct_deploy, direct_alice, direct_bob)
    _mock_evaluation(direct_vm, GARDENING_DOCUMENT, REJECTED)
    before = _balance(direct_vm, direct_bob)
    with direct_vm.prank(direct_alice):
        contract.verify_and_release("1")
    job = _job(contract)
    assert job["ai_verdict"] == "REJECTED"
    assert job["status"] == "DISPUTED"
    assert job["resolved_at"]
    _assert_no_approval_settlement(contract, direct_vm, direct_bob, before)


@pytest.mark.parametrize(
    ("status", "body", "llm", "expected", "reason_fragment"),
    [
        # Current source never reads response.status_code: nonempty 4xx/5xx bodies reach the LLM.
        (404, APPROVAL_DOCUMENT, APPROVED, "APPROVED", None),
        (503, APPROVAL_DOCUMENT, APPROVED, "APPROVED", None),
        (200, "", None, "REJECTED", "empty content"),
        (200, None, None, "REJECTED", "could not be fetched"),
        (200, b"\xff\xfe", None, "REJECTED", "could not be fetched"),
        (200, "x" * 13000, APPROVED, "APPROVED", None),
    ],
)
def test_web_failure_matrix(status, body, llm, expected, reason_fragment,
                            direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _build_state(direct_vm, direct_deploy, direct_alice, direct_bob)
    if llm is not None:
        _mock_evaluation(direct_vm, body, llm, status=status)
    else:
        direct_vm.mock_web(re.escape(DELIVERABLE_URL), {"method": "GET", "status": status, "body": body})
    before = _balance(direct_vm, direct_bob)
    with direct_vm.prank(direct_alice):
        contract.verify_and_release("1")
    job = _job(contract)
    assert job["ai_verdict"] == expected
    if reason_fragment:
        assert reason_fragment in job["ai_reasoning"]
    if expected == "REJECTED":
        _assert_no_approval_settlement(contract, direct_vm, direct_bob, before)


@pytest.mark.parametrize(
    ("llm", "reason_fragment"),
    [
        ("not json", "malformed output"),
        (json.dumps({"approved": True, "score": 90, "reason": "ok"}), "malformed or incomplete"),
        (json.dumps({"approved": "true", "score": 90, "reason": "ok", "evidence_summary": "x"}), "malformed or incomplete"),
        (json.dumps({"approved": True, "score": -1, "reason": "ok", "evidence_summary": "x"}), "malformed or incomplete"),
        (json.dumps({"approved": True, "score": 101, "reason": "ok", "evidence_summary": "x"}), "malformed or incomplete"),
        (json.dumps({"approved": True, "score": 69, "reason": "ok", "evidence_summary": "x"}), "did not meet"),
        ("prefix " + APPROVED + " suffix", "malformed output"),
        ("", "malformed output"),
    ],
)
def test_llm_failure_matrix(llm, reason_fragment, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _build_state(direct_vm, direct_deploy, direct_alice, direct_bob)
    _mock_evaluation(direct_vm, APPROVAL_DOCUMENT, llm)
    before = _balance(direct_vm, direct_bob)
    with direct_vm.prank(direct_alice):
        contract.verify_and_release("1")
    job = _job(contract)
    assert job["status"] == "DISPUTED"
    assert job["ai_verdict"] == "REJECTED"
    assert reason_fragment in job["ai_reasoning"]
    _assert_no_approval_settlement(contract, direct_vm, direct_bob, before)


def _validator_case(direct_vm, contract, web_body, evaluation):
    direct_vm.clear_mocks()
    _mock_evaluation(direct_vm, web_body, evaluation)
    return direct_vm.run_validator()


def test_comparative_consensus_matrix(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _build_state(direct_vm, direct_deploy, direct_alice, direct_bob)
    _mock_evaluation(direct_vm, APPROVAL_DOCUMENT, APPROVED)
    with direct_vm.prank(direct_alice):
        contract.verify_and_release("1")

    same_other_reason = json.dumps({
        "approved": True, "score": 87, "reason": "Different wording.",
        "evidence_summary": "Different summary.",
    })
    # genlayer-test 0.29.2 does not dispatch the pinned SDK's ExecPromptTemplate
    # request, so every prompt_comparative validator returns None.  This is the
    # actual Direct Mode result, not evidence that these values are equivalent.
    assert _validator_case(direct_vm, contract, APPROVAL_DOCUMENT, same_other_reason) is None

    different_approval = json.dumps({
        "approved": False, "score": 20, "reason": "No.", "evidence_summary": "No evidence.",
    })
    assert _validator_case(direct_vm, contract, APPROVAL_DOCUMENT, different_approval) is None

    above_tolerance = json.dumps({
        "approved": True, "score": 70, "reason": "Barely.", "evidence_summary": "Some evidence.",
    })
    assert _validator_case(direct_vm, contract, APPROVAL_DOCUMENT, above_tolerance) is None
    assert _validator_case(direct_vm, contract, APPROVAL_DOCUMENT, "malformed") is None
    assert any("ExecPromptTemplate" in trace for trace in direct_vm._traces)

    # Validator voting never runs settlement: it only returns agree/disagree.
    job = _job(contract)
    assert job["status"] == "PAID"
    assert job["escrow_balance"] == "0"


def test_parse_consensus_result_isolated(direct_vm, direct_deploy):
    contract = direct_deploy(str(CONTRACT), sdk_version=SDK_RELEASE)
    module = sys.modules[type(contract).__module__]
    assert module._parse_consensus_result(APPROVED)["approved"] is True
    for bad in ("", "not json", '{"approved":true}', '{"approved":true,"score":false}'):
        assert module._parse_consensus_result(bad)["approved"] is False

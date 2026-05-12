package com.automationcenter.controller;

import com.automationcenter.dto.aws.AwsAccountRequest;
import com.automationcenter.dto.aws.AwsAccountResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/aws/accounts")
@RequiredArgsConstructor
public class AwsAccountController {

    private final AwsService awsService;

    @PostMapping
    public ResponseEntity<AwsAccountResponse> create(
            @RequestBody @Valid AwsAccountRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.createAccount(user.getId(), req));
    }

    @GetMapping
    public ResponseEntity<List<AwsAccountResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listAccounts(user.getId()));
    }

    @PostMapping("/{id}/sso-login")
    public ResponseEntity<java.util.Map<String, String>> ssoLogin(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.ssoLogin(user.getId(), id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AwsAccountResponse> update(
            @PathVariable Long id,
            @RequestBody @Valid AwsAccountRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.updateAccount(user.getId(), id, req));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        awsService.deleteAccount(user.getId(), id);
        return ResponseEntity.noContent().build();
    }
}
